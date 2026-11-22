// Тестбенч урока 3: перебирает все 16 сочетаний четырёх входов
// и сверяет LED0 с правилом «ровно два входа из четырёх».
module tb_top;
    reg  [3:0] in = 4'b0000;   // {S1, S2, вход 73, вход 74}
    wire       led0;

    top dut (.btn_s1(in[3]), .btn_s2(in[2]), .in3(in[1]), .in4(in[0]), .led0(led0));

    integer i;
    integer errors = 0;
    reg     expected;          // 1 = светодиод должен гореть

    initial begin
        $display("S1 S2 73 74 | горит");
        for (i = 0; i < 16; i = i + 1) begin
            in = i[3:0];
            #10;
            expected = ((in[3] + in[2] + in[1] + in[0]) == 2);
            $display(" %b  %b  %b  %b |   %b", in[3], in[2], in[1], in[0], ~led0);
            if (~led0 !== expected) begin
                $display("  ОШИБКА: ожидали %b", expected);
                errors = errors + 1;
            end
        end
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
