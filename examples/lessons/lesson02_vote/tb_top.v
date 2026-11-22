module tb_top;
    reg a = 0, b = 0, c = 0;
    wire led0;
    top dut (.btn_s1(a), .btn_s2(b), .vote3(c), .led0(led0));
    integer i, errors = 0;
    initial begin
        for (i = 0; i < 8; i = i + 1) begin
            {a, b, c} = i[2:0];
            #10;
            $display("%b %b %b -> горит=%b", a, b, c, ~led0);
            if (~led0 !== (a + b + c >= 2)) errors = errors + 1;
        end
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН"); else $display("ОШИБОК: %0d", errors);
        $finish;
    end
endmodule
