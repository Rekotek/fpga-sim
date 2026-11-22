// Тестбенч урока 2: перебирает все четыре сочетания кнопок
// и сверяет светодиоды с таблицей истинности.
module tb_top;
    reg        s1 = 1'b0;
    reg        s2 = 1'b0;
    wire [5:0] led;

    top dut (.btn_s1(s1), .btn_s2(s2), .led(led));

    integer i;
    integer errors = 0;
    reg [5:0] expected;   // 1 = светодиод должен гореть

    initial begin
        $display(" S1 S2 | NOT AND OR XOR NAND NOR  (1 = горит)");
        for (i = 0; i < 4; i = i + 1) begin
            {s1, s2} = i[1:0];
            #10;
            expected = { ~(s1 | s2), ~(s1 & s2), s1 ^ s2, s1 | s2, s1 & s2, ~s1 };
            $display("  %b  %b |  %b   %b   %b   %b   %b    %b",
                     s1, s2, ~led[0], ~led[1], ~led[2], ~led[3], ~led[4], ~led[5]);
            if (~led !== expected) begin
                $display("  ОШИБКА: led=%b, ожидали %b", led, ~expected);
                errors = errors + 1;
            end
        end
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
